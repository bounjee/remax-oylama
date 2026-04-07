const serverless = require("serverless-http");
const { connectLambda } = require("@netlify/blobs");
const { createApp } = require("../../app");

const app = createApp();
const handler = serverless(app);

exports.handler = async (event, context) => {
  if (event && typeof event.blobs === "string" && event.blobs.length > 0) {
    try {
      connectLambda(event);
    } catch (err) {
      console.error("Netlify Blobs connectLambda:", err);
    }
  }
  return handler(event, context);
};
