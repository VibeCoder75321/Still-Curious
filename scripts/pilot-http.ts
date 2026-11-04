/** Retain recovery identifiers without copying provider bodies or credentials. */
export async function pilotHttpMetadata(response: Response) {
  const requestId = response.headers.get("x-request-id");
  let responseId: string | undefined;
  try {
    const body = await response.clone().json() as { id?: unknown };
    if (typeof body?.id === "string" && /^resp_[a-zA-Z0-9]+$/.test(body.id)) responseId = body.id;
  } catch { /* The provider adapter still validates the original response body. */ }
  return {
    ...(requestId && /^req_[a-zA-Z0-9]+$/.test(requestId) ? { providerRequestId: requestId } : {}),
    ...(responseId ? { responseId } : {}),
  };
}
