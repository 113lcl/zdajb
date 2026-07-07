const baseUrl = (process.env.SMOKE_BASE_URL ?? process.env.PUBLIC_APP_URL ?? "http://127.0.0.1:4174").replace(/\/+$/, "");

const checks = [];

function addCheck(name, run) {
  checks.push({ name, run });
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    redirect: "manual",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {})
    }
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { response, body, text };
}

function expectStatus(result, expected) {
  if (result.response.status !== expected) {
    throw new Error(`Expected HTTP ${expected}, got ${result.response.status}. Body: ${result.text.slice(0, 240)}`);
  }
}

function expectHeader(result, name) {
  const value = result.response.headers.get(name);
  if (!value) throw new Error(`Missing header: ${name}`);
  return value;
}

addCheck("Health endpoint works", async () => {
  const result = await request("/api/health");
  expectStatus(result, 200);
  if (result.body?.ok !== true) throw new Error("Health response is not ok.");
});

addCheck("Security headers are present", async () => {
  const result = await request("/api/health");
  expectHeader(result, "x-content-type-options");
  expectHeader(result, "referrer-policy");
  expectHeader(result, "x-frame-options");
  expectHeader(result, "permissions-policy");
  if (result.response.headers.get("x-powered-by")) throw new Error("x-powered-by header should not be exposed.");
});

addCheck("Plans are public and valid", async () => {
  const result = await request("/api/plans");
  expectStatus(result, 200);
  if (!Array.isArray(result.body) || result.body.length < 4) throw new Error("Expected at least 4 active plans.");
  for (const plan of result.body) {
    if (!plan.code || !plan.name || !Number.isFinite(plan.days) || !Number.isFinite(plan.amount)) {
      throw new Error("Plan has invalid shape.");
    }
  }
});

addCheck("Training questions are public", async () => {
  const result = await request("/api/questions");
  expectStatus(result, 200);
  if (!Array.isArray(result.body) || result.body.length === 0) throw new Error("No public training questions returned.");
});

addCheck("Training video media is public", async () => {
  const result = await request("/api/questions");
  expectStatus(result, 200);
  const videoQuestion = result.body.find((question) => question.mediaType === "video" && question.mediaPath);
  if (!videoQuestion) {
    console.log("SKIP Training video media is public - no video question in public sample");
    return;
  }
  const mediaResult = await request(videoQuestion.mediaPath, { method: "HEAD" });
  expectStatus(mediaResult, 200);
});

addCheck("Random question endpoint works", async () => {
  const result = await request("/api/questions/random");
  expectStatus(result, 200);
  if (!result.body?.id || !result.body?.text) throw new Error("Random question has invalid shape.");
});

addCheck("Exam is blocked for anonymous users", async () => {
  const result = await request("/api/exam");
  expectStatus(result, 401);
});

addCheck("Difficult questions are blocked for anonymous users", async () => {
  const result = await request("/api/difficult");
  expectStatus(result, 401);
});

addCheck("Progress is blocked for anonymous users", async () => {
  const result = await request("/api/progress");
  expectStatus(result, 401);
});

addCheck("Checkout is blocked for anonymous users", async () => {
  const result = await request("/api/checkout", {
    method: "POST",
    body: JSON.stringify({ planCode: "week" })
  });
  expectStatus(result, 401);
});

addCheck("Admin API is blocked for anonymous users", async () => {
  const result = await request("/api/admin/summary");
  expectStatus(result, 401);
});

addCheck("Development grant endpoint is not exposed by default", async () => {
  const result = await request("/api/access/dev-grant", {
    method: "POST",
    body: JSON.stringify({ planCode: "week" })
  });
  expectStatus(result, 404);
});

let failed = 0;
console.log(`Smoke test target: ${baseUrl}`);

for (const check of checks) {
  try {
    await check.run();
    console.log(`OK  ${check.name}`);
  } catch (error) {
    failed += 1;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`FAIL ${check.name}`);
    console.error(`     ${message}`);
  }
}

if (failed) {
  console.error(`Smoke test failed: ${failed}/${checks.length} checks failed.`);
  process.exit(1);
}

console.log(`Smoke test passed: ${checks.length}/${checks.length} checks passed.`);
