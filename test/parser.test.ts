import { describe, expect, it } from "vitest";
import { parseFile, type ParsedFile } from "../src/indexer/parser.js";
import type { ScannedFile } from "../src/indexer/scanner.js";

/** Build the minimal ScannedFile the parser needs. */
function parse(path: string, language: string, content: string): ParsedFile {
  const file: ScannedFile = {
    path,
    absolutePath: `/repo/${path}`,
    language,
    hash: "test",
    size: content.length,
    lineCount: content.split("\n").length,
    content,
  };
  return parseFile(file);
}

const names = (parsed: ParsedFile) => parsed.symbols.map((s) => s.name);

describe("TypeScript parser", () => {
  const parsed = parse(
    "src/payment.ts",
    "typescript",
    `import { Order } from "./types.js";
import fs from "node:fs";

export interface PaymentResult {
  ok: boolean;
}

export class PaymentService {
  processPayment(order: Order): Promise<PaymentResult> {
    return Promise.resolve({ ok: true });
  }
}

export function refund(id: string): void {}
`,
  );

  it("extracts classes, methods, interfaces, and functions", () => {
    expect(names(parsed)).toEqual(
      expect.arrayContaining([
        "PaymentResult",
        "PaymentService",
        "processPayment",
        "refund",
      ]),
    );
  });

  it("qualifies methods with their class and records the parent", () => {
    const method = parsed.symbols.find((s) => s.name === "processPayment");

    expect(method?.kind).toBe("method");
    expect(method?.parent).toBe("PaymentService");
    expect(method?.qualifiedName).toBe("PaymentService.processPayment");
  });

  it("marks exported symbols and records line numbers", () => {
    const cls = parsed.symbols.find((s) => s.name === "PaymentService");

    expect(cls?.exported).toBe(true);
    expect(cls?.startLine).toBeGreaterThan(0);
    expect(cls?.endLine).toBeGreaterThanOrEqual(cls!.startLine);
  });

  it("collects both relative and package imports", () => {
    expect(parsed.imports.map((i) => i.specifier)).toEqual(
      expect.arrayContaining(["./types.js", "node:fs"]),
    );
  });
});

describe("Python parser", () => {
  const parsed = parse(
    "app/service.py",
    "python",
    `import os
from .models import Order


class PaymentService:
    def process(self, order):
        """Charge the order."""
        return True


def refund(payment_id):
    return None
`,
  );

  it("extracts classes, methods, and module-level functions", () => {
    expect(names(parsed)).toEqual(
      expect.arrayContaining(["PaymentService", "process", "refund"]),
    );
  });

  it("collects imports", () => {
    expect(parsed.imports.length).toBeGreaterThan(0);
  });
});

describe("Go parser", () => {
  const parsed = parse(
    "main.go",
    "go",
    `package main

import "fmt"

type Payment struct {
	ID string
}

func (p *Payment) Refund() error {
	return nil
}

func main() {
	fmt.Println("hi")
}
`,
  );

  it("extracts structs, methods, and functions", () => {
    expect(names(parsed)).toEqual(
      expect.arrayContaining(["Payment", "Refund", "main"]),
    );
  });
});

describe("unknown languages", () => {
  it("falls back to the generic parser without throwing", () => {
    const parsed = parse("script.rb", "ruby", "def hello\n  puts 1\nend\n");

    expect(parsed.language).toBe("ruby");
    expect(Array.isArray(parsed.symbols)).toBe(true);
  });
});
