export function decodeBase64Url(value: string): Buffer {
  if (value.length === 0
      || value.length % 4 === 1
      || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new TypeError("value is not canonical base64url");
  }

  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) {
    throw new TypeError("value is not canonical base64url");
  }
  return decoded;
}
