const url =
  process.env.SHRIMP_HEARTBEAT_URL ??
  `http://localhost:${process.env.PORT ?? 3000}/heartbeat`;
const token = process.env.SHRIMP_HEARTBEAT_TOKEN;

const res = await fetch(url, {
  method: "POST",
  headers: token ? { Authorization: `Bearer ${token}` } : {},
});

if (!res.ok) {
  console.error(`heartbeat failed: ${res.status} ${res.statusText}`);
  process.exit(1);
}
