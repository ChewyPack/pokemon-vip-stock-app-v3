export async function onRequestPost({ request }) {
  return new Response(
    JSON.stringify({
      received: true,
      message: "Stripe webhook endpoint is working"
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    }
  );
}
