import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { compile } from "json-schema-to-typescript";
import Ajv from "ajv";
import standalone from "ajv/dist/standalone/index.js";
import ucs2lengthModule from "ajv/dist/runtime/ucs2length.js";
// Ajv's default standalone helper uses CommonJS require even for ESM output.
// Reuse its Unicode implementation inline so portable validators need no runtime dependency.
const ucs2length = ucs2lengthModule.default ?? ucs2lengthModule;
ucs2length.code = ucs2length.toString();
for (const [op, name] of [["schema_timing_error_output","timing-error-output"],["schema_timing_request","timing-request"],["schema_timing_response","timing-response"],["schema_timing_local_response","timing-local-response"],["schema_timing_share_response","timing-share-response"],["schema_handoff_request","handoff-request"],["schema_handoff_response","handoff-response"],["schema_account_request","account-request"],["schema_account_response","account-response"],["schema_directories_request","directories-request"],["schema_directories_response","directories-response"],["schema_analysis_declaration", "analysis-declaration"], ["schema_preferences_request", "preferences-request"], ["schema_preferences_response", "preferences-response"], ["schema_optimize_request", "optimize-request"], ["schema_optimize_response", "optimize-response"], ["schema_config_request", "config-request"], ["schema_config_response", "config-response"], ["schema_live_request", "live-request"], ["schema_live_response", "live-response"], ["schema_usage_app", "usage-app"], ["schema_usage_request", "usage-request"], ["schema_pricing_request", "pricing-request"], ["schema_pricing_response", "pricing-response"]]) {
  const result = spawnSync(process.platform === 'win32' ? "core/target/debug/wombat-core.exe" : "core/target/debug/wombat-core", [], {
    input: JSON.stringify({ op, args: {} }),
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr);
  const response = JSON.parse(result.stdout);
  if (!response.ok) throw new Error(response.error);
  const schema = response.value;
  const normalize = (v) => {
    if (!v || typeof v !== "object") return;
    if (["uint8", "uint32", "uint64", "uint", "usize"].includes(v.format)) {
      const maximum = v.format === "uint8" ? 255 : v.format === "uint32" ? 4294967295 : 9007199254740991;
      v.maximum = Math.min(v.maximum ?? maximum, maximum);
      delete v.format;
    }
    if (v.format === "int64") { v.minimum = Math.max(v.minimum ?? -9007199254740991, -9007199254740991); v.maximum = Math.min(v.maximum ?? 9007199254740991, 9007199254740991); delete v.format; }
    if (["double", "float"].includes(v.format)) delete v.format;
    Object.values(v).forEach(normalize);
  };
  normalize(schema);
  const ajv = new Ajv({ code: { source: true, esm: true }, strict: true });
  const validate = ajv.compile(schema);
  const rootType=name==='timing-error-output'?'TimingErrorOutput':name==='timing-local-response'?'LocalResponse':name==='timing-share-response'?'ShareResponse':name==='analysis-declaration'?'AnalysisDeclaration':name.endsWith("request")?"Request":"Response";
  const timingResult = ["timing-response", "timing-local-response", "timing-share-response"].includes(name);
  const outputs = {
    [`docs/schemas/${name}-${timingResult ? "v4" : (name=== "analysis-declaration" || name.startsWith("pricing-") || name.startsWith("live-") || name.startsWith("config-") || name.startsWith("optimize-") || name.startsWith("preferences-") || name.startsWith("directories-") || name.startsWith("account-") || name.startsWith("handoff-") || name.startsWith("timing-")) ? "v1" : name === "usage-app" ? "v5" : "v3"}.schema.json`]:
      JSON.stringify(schema, null, 2) + "\n",
    [`client/src/generated/${name}.ts`]: await compile(schema, rootType, {
      bannerComment: "/* Generated from Rust. Run pnpm contracts:generate. */",
      additionalProperties: false,
    }),
    [`client/src/generated/validate-${name}.js`]: standalone.default
      ? standalone.default(ajv, validate)
      : standalone(ajv, validate),
  };
  outputs[`client/src/generated/validate-${name}.d.ts`] = `import type { ${rootType} } from './${name}.js';\nexport function validate(value: unknown): value is ${rootType};\n`;
  for (const [file, content] of Object.entries(outputs)) {
    if (process.argv.includes("--check")) {
      if ((await readFile(file, "utf8")) !== content)
        throw new Error(`Contract drift: ${file}`);
    } else await writeFile(file, content);
  }
}
