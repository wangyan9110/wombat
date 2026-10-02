import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { compile } from "json-schema-to-typescript";
import Ajv from "ajv";
import standalone from "ajv/dist/standalone/index.js";
for (const [op, name] of [["schema_analysis_declaration", "analysis-declaration"], ["schema_preferences_request", "preferences-request"], ["schema_preferences_response", "preferences-response"], ["schema_optimize_request", "optimize-request"], ["schema_optimize_response", "optimize-response"], ["schema_config_request", "config-request"], ["schema_config_response", "config-response"], ["schema_live_request", "live-request"], ["schema_live_response", "live-response"], ["schema_usage_app", "usage-app"], ["schema_usage_request", "usage-request"], ["schema_pricing_request", "pricing-request"], ["schema_pricing_response", "pricing-response"]]) {
  const result = spawnSync(process.platform === 'win32' ? "core/target/debug/wombat-core.exe" : "core/target/debug/wombat-core", [], {
    input: JSON.stringify({ op, args: {} }),
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(result.stderr);
  const response = JSON.parse(result.stdout);
  if (!response.ok) throw new Error(response.error);
  const schema = response.value;
  const normalize = (v) => {
    if (!v || typeof v !== "object") return;
    if (["uint8", "uint32", "uint64", "uint", "usize"].includes(v.format)) {
      v.maximum = v.format === "uint8" ? 255 : v.format === "uint32" ? 4294967295 : 9007199254740991;
      delete v.format;
    }
    if (v.format === "int64") { v.minimum = -9007199254740991; v.maximum = 9007199254740991; delete v.format; }
    if (["double", "float"].includes(v.format)) delete v.format;
    Object.values(v).forEach(normalize);
  };
  normalize(schema);
  const ajv = new Ajv({ code: { source: true, esm: true }, strict: true });
  const validate = ajv.compile(schema);
  const outputs = {
    [`docs/schemas/${name}-${(name=== "analysis-declaration" || name.startsWith("pricing-") || name.startsWith("live-") || name.startsWith("config-") || name.startsWith("optimize-") || name.startsWith("preferences-")) ? "v1" : "v3"}.schema.json`]:
      JSON.stringify(schema, null, 2) + "\n",
    [`client/src/generated/${name}.ts`]: await compile(schema, "Response", {
      bannerComment: "/* Generated from Rust. Run pnpm contracts:generate. */",
      additionalProperties: false,
    }),
    [`client/src/generated/validate-${name}.js`]: standalone.default
      ? standalone.default(ajv, validate)
      : standalone(ajv, validate),
  };
  const rootType=name==='analysis-declaration'?'AnalysisDeclaration':name.endsWith("request")?"Request":"Response";
  outputs[`client/src/generated/validate-${name}.d.ts`] = `import type { ${rootType} } from './${name}.js';\nexport function validate(value: unknown): value is ${rootType};\n`;
  for (const [file, content] of Object.entries(outputs)) {
    if (process.argv.includes("--check")) {
      if ((await readFile(file, "utf8")) !== content)
        throw new Error(`Contract drift: ${file}`);
    } else await writeFile(file, content);
  }
}
