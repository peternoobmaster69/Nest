/** Remove a set of single-character delimiters without retrying a regular expression at every offset.
 * @param {string} value
 * @param {string} characters
 */
export function trimEndCharacters(value, characters) {
  let end = value.length;
  while (end > 0 && characters.includes(value[end - 1])) end -= 1;
  return value.slice(0, end);
}

/** @param {string} value @param {string} characters */
export function trimCharacters(value, characters) {
  let start = 0;
  while (start < value.length && characters.includes(value[start])) start += 1;
  return trimEndCharacters(value.slice(start), characters);
}
