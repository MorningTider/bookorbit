// Exercise compiled module evaluation, which source-level tests do not cover.
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "isolated-module-verification-only";
process.env.DATABASE_URL = "postgres://verification:verification@127.0.0.1/verification";
require("../../server/dist/app.module.js");
console.log("Compiled AppModule loaded successfully");
