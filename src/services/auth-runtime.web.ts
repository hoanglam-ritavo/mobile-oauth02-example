export function createNativeAuthSession(): never {
  throw new Error('Sign-in is supported on Android and iOS only.');
}
