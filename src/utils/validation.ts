export const validateRequiredFields = (
  payload: Record<string, unknown>,
  requiredFields: string[],
): string[] => {
  return requiredFields.filter((field) => {
    const value = payload?.[field];
    return value === undefined || value === null || value === '';
  });
};
