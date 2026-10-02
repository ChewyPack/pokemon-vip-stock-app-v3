export async function onRequestPost() {
  return new Response(
    JSON.stringify({
      ok: true,
      message: "REPORT FUNCTION IS WORKING"
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    }
  );
}

export async function onRequest() {
  return new Response(
    JSON.stringify({
      ok: true,
      message: "REPORT ROUTE IS WORKING"
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    }
  );
}
