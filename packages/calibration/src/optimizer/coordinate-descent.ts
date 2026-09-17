import { CalibrationParameter, CalibrationIteration, CalibrationResult } from '../types.js';

export interface OptimizationOptions {
  parameters: CalibrationParameter[];
  maxCycles?: number;
  tolerance?: number;
  evaluator: (params: Record<string, number>) => Promise<{
    loss: number;
    ksStatistic?: number;
    mape: number;
    verdict: string;
  }>;
}

export async function runCoordinateDescent(options: OptimizationOptions): Promise<CalibrationResult> {
  const {
    parameters,
    maxCycles = 5,
    tolerance = 0.05,
    evaluator,
  } = options;

  const currentParams: Record<string, number> = {};
  const initialParams: Record<string, number> = {};
  for (const p of parameters) {
    currentParams[p.name] = p.currentValue;
    initialParams[p.name] = p.currentValue;
  }

  const iterations: CalibrationIteration[] = [];
  let iterCount = 0;

  // Initial evaluation
  const initialEval = await evaluator(currentParams);
  iterCount++;
  iterations.push({
    iteration: iterCount,
    parameters: { ...currentParams },
    loss: initialEval.loss,
    ksStatistic: initialEval.ksStatistic,
    mape: initialEval.mape,
    verdict: initialEval.verdict,
  });

  const initialLoss = initialEval.loss;
  let bestLoss = initialLoss;

  for (let cycle = 0; cycle < maxCycles; cycle++) {
    let improvedInCycle = false;

    for (const param of parameters) {
      // Progressive interval refinement around current best value
      const curBest = currentParams[param.name];
      const span = (param.maxValue - param.minValue) / Math.pow(2, cycle);
      const low = Math.max(param.minValue, curBest - span / 2);
      const high = Math.min(param.maxValue, curBest + span / 2);

      const candidates = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1.0].map(
        (f) => low + (high - low) * f,
      );

      let bestValForParam = currentParams[param.name];

      for (const cand of candidates) {
        currentParams[param.name] = Math.round(cand);
        const evalRes = await evaluator(currentParams);
        iterCount++;
        iterations.push({
          iteration: iterCount,
          parameters: { ...currentParams },
          loss: evalRes.loss,
          ksStatistic: evalRes.ksStatistic,
          mape: evalRes.mape,
          verdict: evalRes.verdict,
        });

        if (evalRes.loss < bestLoss) {
          bestLoss = evalRes.loss;
          bestValForParam = Math.round(cand);
          improvedInCycle = true;
        }
      }

      currentParams[param.name] = bestValForParam;

      if (bestLoss <= tolerance) {
        break;
      }
    }

    if (!improvedInCycle || bestLoss <= tolerance) {
      break;
    }
  }

  // Calculate parameter deltas
  const parameterDeltas: Record<string, { initial: number; calibrated: number; deltaPercent: number }> = {};
  for (const p of parameters) {
    const init = initialParams[p.name];
    const cal = currentParams[p.name];
    const deltaPercent = init > 0 ? ((cal - init) / init) * 100 : 0;
    parameterDeltas[p.name] = { initial: init, calibrated: cal, deltaPercent };
  }

  return {
    converged: bestLoss <= tolerance || bestLoss < initialLoss * 0.5,
    initialLoss,
    finalLoss: bestLoss,
    calibratedParameters: currentParams,
    parameterDeltas,
    iterations,
  };
}
