import assert from "node:assert/strict";
import test, { beforeEach, mock } from "node:test";
import { calls, require } from "./finance-route-harness.mjs";

let dnsResult, fetchResponse, dnsCalls, fetchCalls;
mock.module("node:dns/promises", { namedExports: {
  async lookup(hostname, options) {
    dnsCalls.push({ hostname, options });
    if (dnsResult instanceof Error) throw dnsResult;
    return typeof dnsResult === "function" ? dnsResult(hostname) : dnsResult;
  },
} });
const { PublicFinancialSourceError, readPublicFinancialSource, isAuthoritativeFinancialHostname } = require("../lib/ai/public-financial-source.ts");
const url = "https://www.sec.gov/research/report#table";
const plain = text => new Response(text, { headers: { "content-type": "text/plain; charset=utf-8" } });
const html = text => new Response(text, { headers: { "content-type": "text/html; charset=utf-8" } });
const redirect = (location, status = 302) => new Response(null, { status, headers: location === undefined ? {} : { location } });

beforeEach(t => {
  dnsResult = [{ address: "8.8.8.8" }];
  dnsCalls = [];
  fetchCalls = [];
  fetchResponse = () => plain("Annual inflation was 3.5%. Household spending was SGD 3,500.");
  t.mock.method(globalThis, "fetch", async (input, options) => {
    fetchCalls.push({ url: new URL(input), options });
    return fetchResponse();
  });
});

async function rejected(code, input = url, message) {
  await assert.rejects(readPublicFinancialSource(input), error => {
    assert.ok(error instanceof PublicFinancialSourceError);
    assert.equal(error.name, "PublicFinancialSourceError");
    assert.equal(error.code, code);
    if (message) assert.match(error.message, message);
    return true;
  });
}

test("financial-source authority matching includes official subdomains and rejects suffix lookalikes", () => {
  for (const host of ["gov.sg", "data.gov.sg", "sec.gov", "ons.gov.uk", "abs.gov.au", "boj.go.jp", "research.edu", "nus.edu.sg", "lse.ac.uk",
    "bis.org", "ecb.europa.eu", "europa.eu", "federalreserve.gov", "imf.org", "oecd.org", "sgx.com", "worldbank.org", "DATA.WORLDBANK.ORG", "WWW.SEC.GOV."])
    assert.equal(isAuthoritativeFinancialHostname(host), true, host);
  for (const host of ["example.com", "sec.gov.example.com", "notgov.sg", "evil-imf.org", "worldbank.org.attacker.test", "localhost", "127.0.0.1"])
    assert.equal(isAuthoritativeFinancialHostname(host), false, host);
});

test("source URLs must be valid, public-authority HTTPS URLs without embedded credentials", async () => {
  for (const value of ["not a URL", "https://[invalid", "http://sec.gov/report", "file:///etc/passwd", "https://user@sec.gov/report", "https://:password@sec.gov/report"])
    await rejected("INVALID_URL", value);
  for (const value of ["https://example.com/report", "https://sec.gov.attacker.test/report", "https://127.0.0.1/report"])
    await rejected("SOURCE_NOT_ALLOWED", value);
  assert.deepEqual(dnsCalls, []);
  assert.deepEqual(fetchCalls, []);
});

test("public research validates DNS before fetching, strips fragments and returns normalized source metadata", async () => {
  const result = await readPublicFinancialSource(url);
  assert.equal(result.url, "https://www.sec.gov/research/report");
  assert.equal(result.domain, "sec.gov");
  assert.equal(result.title, "Public financial source from sec.gov");
  assert.equal(result.contentType, "text/plain");
  assert.equal(result.excerpt, "Annual inflation was 3.5%. Household spending was SGD 3,500.");
  assert.deepEqual(result.normalizedFinancialValues, ["SGD 3,500"]);
  assert.ok(result.retrievedAt instanceof Date);
  assert.deepEqual(dnsCalls, [{ hostname: "www.sec.gov", options: { all: true, verbatim: true } }]);
  assert.equal(fetchCalls[0].url.hash, "");
  assert.equal(fetchCalls[0].options.redirect, "manual");
  assert.equal(fetchCalls[0].options.cache, "no-store");
  assert.equal(fetchCalls[0].options.method, "GET");
  assert.equal(fetchCalls[0].options.headers["User-Agent"], "Nest-CIO-Public-Research/1.0");
  assert.ok(fetchCalls[0].options.signal instanceof AbortSignal);
  assert.deepEqual(calls, [], "reading a public source must not read private workspace records");
});

test("DNS failures and empty answer sets cannot initiate external requests", async () => {
  dnsResult = new Error("Resolver unavailable");
  await rejected("UNAVAILABLE", url, /could not be resolved/);
  dnsResult = [];
  await rejected("PRIVATE_ADDRESS_REJECTED");
  assert.deepEqual(fetchCalls, []);
});

test("every private or reserved answer is rejected, including mixed DNS answers and IPv4-mapped IPv6", async () => {
  for (const address of [
    "0.0.0.0", "10.0.0.1", "127.0.0.1", "224.0.0.1", "255.255.255.255", "100.64.0.1", "100.127.255.254", "169.254.169.254",
    "172.16.0.1", "172.31.255.254", "192.0.0.1", "192.168.1.1", "198.18.0.1", "198.19.255.254",
    "::", "::1", "fc00::1", "fd12::1", "fe80::1", "fe90::1", "fea0::1", "feb0::1", "::ffff:10.1.2.3",
    "::ffff:1.2.3", "::ffff:1.2.3.256", "::ffff:1.2.3.-1", "::ffff:1.2.3.word", "not-an-address",
  ]) {
    dnsResult = [{ address: "8.8.8.8" }, { address }];
    await rejected("PRIVATE_ADDRESS_REJECTED");
  }
  assert.deepEqual(fetchCalls, []);
});

test("public IPv4 and IPv6 addresses adjacent to reserved ranges remain readable", async () => {
  for (const address of ["100.63.255.254", "100.128.0.1", "169.253.1.1", "172.15.255.254", "172.32.0.1", "192.1.1.1", "198.17.1.1", "198.20.1.1", "::ffff:8.8.8.8", "2001:4860:4860::8888"]) {
    dnsResult = [{ address }];
    assert.equal((await readPublicFinancialSource(url)).domain, "sec.gov");
  }
  assert.equal(fetchCalls.length, 10);
});

test("redirects revalidate each destination and allow at most three hops", async () => {
  const responses = [redirect("/second", 301), redirect("https://imf.org/third#section", 307), redirect("/fourth", 308), plain("Final evidence")];
  fetchResponse = () => responses.shift();
  const result = await readPublicFinancialSource(url);
  assert.equal(result.url, "https://imf.org/fourth");
  assert.equal(result.domain, "imf.org");
  assert.deepEqual(dnsCalls.map(({ hostname }) => hostname), ["www.sec.gov", "www.sec.gov", "imf.org", "imf.org"]);
  assert.equal(fetchCalls.length, 4);
});

test("a fourth redirect and a redirect without a location fail with a bounded number of requests", async () => {
  fetchResponse = () => redirect("/again");
  await rejected("UNAVAILABLE", url, /too many redirects/);
  assert.equal(fetchCalls.length, 4);
  fetchCalls.length = 0;
  fetchResponse = () => redirect(undefined, 300);
  await rejected("UNAVAILABLE");
  assert.equal(fetchCalls.length, 1);
});

test("redirects cannot reach untrusted authorities, private addresses or malformed URLs", async () => {
  fetchResponse = () => redirect("https://attacker.test/");
  await rejected("SOURCE_NOT_ALLOWED");
  fetchResponse = () => redirect("https://[invalid");
  await rejected("INVALID_URL");
  dnsResult = hostname => [{ address: hostname === "imf.org" ? "127.0.0.1" : "8.8.8.8" }];
  fetchResponse = () => redirect("https://imf.org/private");
  await rejected("PRIVATE_ADDRESS_REJECTED");
  assert.equal(fetchCalls.length, 3);
  assert.ok(fetchCalls.every(({ url: value }) => value.hostname === "www.sec.gov"));
});

test("transport and HTTP failures are reported as unavailable without leaking transport details", async () => {
  fetchResponse = () => Promise.reject(new Error("Internal proxy configuration"));
  await rejected("UNAVAILABLE", url, /could not be reached/);
  for (const status of [400, 403, 500]) {
    fetchResponse = () => new Response(null, { status });
    await rejected("UNAVAILABLE", url, new RegExp(`HTTP ${status}`));
  }
});

test("unsupported or absent content types fail before being treated as financial evidence", async () => {
  for (const contentType of [undefined, "application/pdf", "image/png", "application/xml"]) {
    fetchResponse = () => new Response(null, { headers: contentType ? { "content-type": contentType } : {} });
    await rejected("UNSUPPORTED_CONTENT");
  }
});

test("HTML sources deduplicate readable sections and omit scripts, style, templates and short headings", async () => {
  fetchResponse = () => html('<title>Rate &amp; outlook</title><h1>Rate &amp; outlook</h1><p>x</p><p>Inflation: 3.5%</p><p>Inflation: 3.5%</p><p>Household income rose to S$6,500.</p><script>hidden-code</script><style>hidden-style</style><template>hidden-template</template>');
  const result = await readPublicFinancialSource(url);
  assert.equal(result.title, "Rate & outlook");
  assert.equal(result.excerpt, "Rate & outlook\nInflation: 3.5%\nHousehold income rose to S$6,500.");
  assert.deepEqual(result.normalizedFinancialValues, ["SGD 6,500"]);
});

test("HTML without a title or section tags falls back to visible document text without repeating a title-only document", async () => {
  for (const [document, title, excerpt] of [
    ["<div>Plain <b>financial</b> evidence.</div>", "Plain financial evidence.", "Plain financial evidence."],
    ["<title>Title alone</title>", "Title alone", "Title alone"],
    ["<p>x</p>", "x", "x"],
    ["<h1>Heading alone</h1>", "Heading alone", "Heading alone"],
  ]) {
    fetchResponse = () => html(document);
    const result = await readPublicFinancialSource(url);
    assert.equal(result.title, title);
    assert.equal(result.excerpt, excerpt);
  }
});

test("empty bodies and entirely hidden HTML are never returned as readable evidence", async () => {
  for (const response of [() => plain(null), () => plain(" \n\t "), () => html("<script>hidden</script>")]) {
    fetchResponse = response;
    await rejected("NO_READABLE_CONTENT");
  }
});

test("HTML titles and excerpts are bounded even when an individual section exceeds the excerpt limit", async () => {
  fetchResponse = () => html(`<title>${"T".repeat(400)}</title><p>${"A".repeat(19000)}</p><p>Beyond the excerpt</p>`);
  const result = await readPublicFinancialSource(url);
  assert.equal(result.title.length, 300);
  assert.equal(result.excerpt.length, 18000);
  assert.ok(!result.excerpt.includes("Beyond the excerpt"));
});

test("JSON evidence normalizes whitespace and clips excerpts while retaining the source's content type", async () => {
  fetchResponse = () => new Response('{\n "inflation": "3.5%"\n}', { headers: { "content-type": "APPLICATION/JSON; charset=UTF-8" } });
  const result = await readPublicFinancialSource(url);
  assert.equal(result.contentType, "application/json");
  assert.equal(result.excerpt, '{ "inflation": "3.5%" }');
});

test("streaming text preserves Unicode split across chunks and accepts the exact byte limit", async () => {
  const bytes = new TextEncoder().encode("💰 annual return: 4.5%.");
  fetchResponse = () => new Response(new ReadableStream({ start(controller) {
    controller.enqueue(bytes.slice(0, 2));
    controller.enqueue(bytes.slice(2));
    controller.close();
  } }), { headers: { "content-type": "text/plain" } });
  assert.equal((await readPublicFinancialSource(url)).excerpt, "💰 annual return: 4.5%.");
  fetchResponse = () => plain("A".repeat(750000));
  const result = await readPublicFinancialSource(url);
  assert.equal(result.excerpt, "A".repeat(18000));
});

for (const cancelFails of [false, true]) {
  test(`oversized sources cancel the stream even when cancellation ${cancelFails ? "fails" : "succeeds"}`, async () => {
    let cancellations = 0;
    fetchResponse = () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(749999));
        controller.enqueue(new Uint8Array(2));
      },
      cancel() {
        cancellations += 1;
        if (cancelFails) return Promise.reject(new Error("Transport already closed"));
      },
    }), { headers: { "content-type": "text/plain" } });
    await rejected("SOURCE_TOO_LARGE");
    assert.equal(cancellations, 1);
  });
}
