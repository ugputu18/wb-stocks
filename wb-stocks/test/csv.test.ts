import { describe, expect, it } from "vitest";
import { toCsv } from "../src/server/csv.js";

describe("toCsv", () => {
  it("writes header and escapes comma and quotes", () => {
    const s = toCsv(
      [
        { a: 1, b: 'x,y', c: 'say "hi"' },
        { a: null, b: undefined, c: "ok" },
      ],
      ["a", "b", "c"],
    );
    expect(s.split("\r\n")).toEqual([
      "a,b,c",
      '1,"x,y","say ""hi"""',
      ',,ok',
    ]);
  });

  it("null and undefined become empty", () => {
    const s = toCsv([{ x: null }], ["x"]);
    expect(s).toBe("x\r\n");
  });
});
