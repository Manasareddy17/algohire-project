import { ActionType, Modules } from '../core/enums/value.enum';

export function buildResponse(module: Modules, id: string, action: ActionType, data?: object) {
  return {
    id,
    message: `${module} ${action} successfully`,
    ...(data ? { data } : {}),
  };
}
