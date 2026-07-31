import fs from "node:fs/promises";
import { blockedRenderEvidence, validateRenderEvidence } from "../lib/render-evidence";
import type { RenderEvidenceExpectation, RenderEvidenceResult } from "../lib/render-evidence";

interface CliOptions {
  artifactPath: string;
  receiptPath: string;
  outputPath?: string;
  help?: boolean;
  expectation: RenderEvidenceExpectation;
}

function usage(): string {
  return [
    "Usage: npm run render:evidence -- --artifact <file.html|file.svg> --receipt <receipt.json> --viewport <width>x<height> [--selector <css>]... [--output <result.json>]",
    "",
    "The receipt must be produced by a fixed-viewport browser adapter. This command validates its bounded facts; it does not compare pixels or launch a browser.",
  ].join("\n");
}

function nextValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function parseViewport(raw: string): { width: number; height: number } {
  const match = /^(\d+)x(\d+)$/.exec(raw);
  if (!match) throw new Error(`viewport must be WIDTHxHEIGHT, got ${raw}`);
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new Error(`viewport must contain positive integer dimensions, got ${raw}`);
  }
  return { width, height };
}

function parseArgs(argv: string[]): CliOptions {
  let artifactPath: string | undefined;
  let receiptPath: string | undefined;
  let outputPath: string | undefined;
  let viewport: { width: number; height: number } | undefined;
  let deviceScaleFactor = 1;
  const selectors: Array<{ selector: string }> = [];

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    switch (flag) {
      case "--artifact":
        artifactPath = nextValue(argv, index, flag);
        index += 1;
        break;
      case "--receipt":
        receiptPath = nextValue(argv, index, flag);
        index += 1;
        break;
      case "--viewport":
        viewport = parseViewport(nextValue(argv, index, flag));
        index += 1;
        break;
      case "--device-scale-factor": {
        const raw = nextValue(argv, index, flag);
        deviceScaleFactor = Number(raw);
        if (!Number.isFinite(deviceScaleFactor) || deviceScaleFactor <= 0 || deviceScaleFactor > 8) {
          throw new Error(`device scale factor must be >0 and <=8, got ${raw}`);
        }
        index += 1;
        break;
      }
      case "--selector":
        selectors.push({ selector: nextValue(argv, index, flag) });
        index += 1;
        break;
      case "--output":
        outputPath = nextValue(argv, index, flag);
        index += 1;
        break;
      case "--help":
        return { artifactPath: "", receiptPath: "", help: true, expectation: { artifactPath: "help.html", viewport: { width: 1, height: 1 } } };
      default:
        throw new Error(`unknown argument: ${flag}`);
    }
  }

  if (!artifactPath || !receiptPath || !viewport) throw new Error(`--artifact, --receipt, and --viewport are required\n\n${usage()}`);
  return {
    artifactPath,
    receiptPath,
    outputPath,
    expectation: {
      artifactPath,
      viewport: { ...viewport, deviceScaleFactor },
      selectors,
    },
  };
}

async function main(): Promise<void> {
  let options: CliOptions;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    console.log(usage());
    return;
  }

  let result: RenderEvidenceResult | null = null;
  try {
    const [artifactText, receiptText] = await Promise.all([
      fs.readFile(options.artifactPath, "utf8"),
      fs.readFile(options.receiptPath, "utf8"),
    ]);
    let receipt: unknown;
    try {
      receipt = JSON.parse(receiptText);
    } catch (error) {
      result = blockedRenderEvidence(options.expectation, `receipt JSON is invalid: ${String(error).slice(0, 300)}`);
    }
    if (!result) result = validateRenderEvidence({ artifactText, receipt, expectation: options.expectation });
  } catch (error) {
    result = blockedRenderEvidence(options.expectation, `could not read artifact or receipt: ${String(error).slice(0, 300)}`);
  }

  const finalResult = result ?? blockedRenderEvidence(options.expectation, "render evidence did not produce a result");
  const serialized = JSON.stringify(finalResult, null, 2);
  if (options.outputPath) await fs.writeFile(options.outputPath, `${serialized}\n`, "utf8");
  console.log(serialized);
  process.exitCode = finalResult.status === "pass" ? 0 : 1;
}

void main();
