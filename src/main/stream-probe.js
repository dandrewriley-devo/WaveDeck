const http = require("http");
const https = require("https");

function parseHttpUrl(value) {
  let url;
  try {
    url = new URL(String(value ?? "").trim());
  } catch {
    throw new Error("Invalid URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS stream URLs are supported.");
  }
  return url;
}

function requestOnce(url, method, timeoutMs) {
  const client = url.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };

    const request = client.request(url, {
      method,
      headers: {
        "User-Agent": "WaveDeck/0.1",
        "Accept": "audio/*, application/ogg, application/octet-stream, */*",
        "Icy-MetaData": "1",
        ...(method === "GET" ? { Range: "bytes=0-0" } : {})
      }
    }, (response) => {
      finish(resolve, {
        status: response.statusCode || 0,
        headers: response.headers
      });
      response.destroy();
    });

    request.setTimeout(timeoutMs, () => request.destroy(new Error("Request timed out.")));
    request.once("error", (error) => finish(reject, error));
    request.end();
  });
}

async function probeStream(value, { timeoutMs = 6000, maxRedirects = 5 } = {}) {
  let current;
  try {
    current = parseHttpUrl(value);
  } catch (error) {
    return { ok: false, status: null, finalUrl: null, message: error.message };
  }

  let method = "HEAD";
  for (let redirects = 0; redirects <= maxRedirects; redirects++) {
    let response;
    try {
      response = await requestOnce(current, method, timeoutMs);
    } catch (error) {
      if (method === "HEAD") {
        method = "GET";
        redirects--;
        continue;
      }
      return {
        ok: false,
        status: null,
        finalUrl: current.toString(),
        message: `Failed (${error.message}).`
      };
    }

    const { status, headers } = response;
    if (status >= 300 && status < 400 && headers.location) {
      if (redirects === maxRedirects) {
        return {
          ok: false,
          status,
          finalUrl: current.toString(),
          message: "Failed (too many redirects)."
        };
      }

      try {
        current = parseHttpUrl(new URL(headers.location, current).toString());
      } catch (error) {
        return { ok: false, status, finalUrl: current.toString(), message: error.message };
      }
      continue;
    }

    if (method === "HEAD" && [400, 403, 405, 501].includes(status)) {
      method = "GET";
      redirects--;
      continue;
    }

    if (status >= 200 && status < 400) {
      return {
        ok: true,
        status,
        finalUrl: current.toString(),
        message: `Stream responded successfully (HTTP ${status}).`
      };
    }

    return {
      ok: false,
      status,
      finalUrl: current.toString(),
      message: `Failed (HTTP ${status}).`
    };
  }

  return { ok: false, status: null, finalUrl: current.toString(), message: "Stream test failed." };
}

module.exports = { parseHttpUrl, probeStream, requestOnce };
