export async function handleUploadPresigned({ body, getSignedToken }) {
  const pathname = body?.payload?.pathname ?? body?.pathname;
  return getSignedToken(pathname);
}
