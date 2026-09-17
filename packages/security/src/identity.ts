import { Role } from '@blackbox-x/contracts';

export interface Principal {
  userId: string;
  tenantId: string;
  roles: Role[];
  scopes: string[];
}

export interface SecurityContext {
  principal: Principal;
  requestId: string;
  timestamp: Date;
}

export function createSecurityContext(
  principal: Principal,
  requestId: string,
): SecurityContext {
  return {
    principal,
    requestId,
    timestamp: new Date(),
  };
}
