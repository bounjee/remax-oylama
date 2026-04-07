const serverless = require("serverless-http");
const { connectLambda } = require("@netlify/blobs");
const { createApp } = require("../../app");

const app = createApp();
const slsHandler = serverless(app);

function flattenHeaders(event) {
  const out = {};
  const h = event && event.headers ? event.headers : {};
  for (const [k, v] of Object.entries(h)) {
    const val = Array.isArray(v) ? v[0] : v;
    out[k.toLowerCase()] = val;
  }
  const mvh = event && event.multiValueHeaders ? event.multiValueHeaders : {};
  for (const [k, vals] of Object.entries(mvh)) {
    if (vals && vals.length && out[k.toLowerCase()] === undefined) {
      out[k.toLowerCase()] = vals[0];
    }
  }
  return out;
}

function safeConnectBlobs(event) {
  if (!event || typeof event.blobs !== "string" || !event.blobs.length) {
    return false;
  }
  const h = flattenHeaders(event);
  const deployID = h["x-nf-deploy-id"];
  const siteID = h["x-nf-site-id"];
  if (!siteID) {
    console.error("Netlify Blobs: event.blobs var ama x-nf-site-id yok", Object.keys(h));
    return false;
  }
  try {
    connectLambda({
      blobs: event.blobs,
      headers: {
        "x-nf-deploy-id": deployID,
        "x-nf-site-id": siteID
      }
    });
    return true;
  } catch (err) {
    console.error("connectLambda:", err && err.message, err && err.stack);
    return false;
  }
}

exports.handler = async (event, context) => {
  safeConnectBlobs(event);
  return slsHandler(event, context);
};
