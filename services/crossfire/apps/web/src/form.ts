export function filterQuery(form: HTMLFormElement): URLSearchParams {
  const query = new URLSearchParams();
  for (const [key, value] of new FormData(form)) if (typeof value === 'string' && value) query.set(key, value);
  return query;
}
