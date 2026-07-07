/** Contraseña requerida para eliminar un tipo de evaluación (validación en servidor). */
export const EVAL_TYPE_DELETE_PASSWORD = "bitacora";

export function isValidEvalTypeDeletePassword(password: unknown): boolean {
  return typeof password === "string" && password === EVAL_TYPE_DELETE_PASSWORD;
}
