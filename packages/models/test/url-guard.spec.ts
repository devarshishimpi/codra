import { describe, expect, it } from "vitest";
import {
  assertPublicBaseUrl,
  isPrivateHost,
  isValidPublicUrl,
} from "../src/url-guard";
import { ProviderRequestError } from "../src/types";

// Guards SSRF via user-supplied provider base URLs (was missing from Anthropic adapter).
describe("provider base URL guard", () => {
  it("rejects loopback, link-local and RFC1918 hosts", () => {
    const blocked = [
      "http://127.0.0.1/v1",
      "http://localhost:8080/v1",
      "http://10.0.0.5/v1",
      "http://192.168.1.1/v1",
      "http://172.16.0.1/v1",
      "http://172.31.255.255/v1",
      "http://169.254.169.254/latest/meta-data", // cloud metadata range
    ];
    for (const url of blocked) {
      expect(isValidPublicUrl(url), url).toBe(false);
    }
  });

  // hostname includes brackets, e.g. "[::1]"; a bare /^::1$/ regex would miss it
  it("rejects IPv6 private ranges, brackets and all", () => {
    const blocked = [
      "http://[::1]/v1",
      "http://[::]/v1",
      "http://[fc00::1]/v1",
      "http://[fd12:3456::1]/v1",
      "http://[fe80::1]/v1",
      "http://[::ffff:127.0.0.1]/v1",
    ];
    for (const url of blocked) {
      expect(isValidPublicUrl(url), url).toBe(false);
    }
    expect(isValidPublicUrl("http://[2606:4700::1111]/v1")).toBe(true);
  });

  it("rejects cloud metadata endpoints by name", () => {
    expect(
      isValidPublicUrl("http://metadata.google.internal/computeMetadata/v1"),
    ).toBe(false);
    expect(isValidPublicUrl("http://100.100.100.200/latest/meta-data")).toBe(
      false,
    );
  });

  it("rejects non-HTTP schemes and unparseable input", () => {
    expect(isValidPublicUrl("file:///etc/passwd")).toBe(false);
    expect(isValidPublicUrl("ftp://example.com")).toBe(false);
    expect(isValidPublicUrl("not a url")).toBe(false);
    expect(isValidPublicUrl("")).toBe(false);
  });

  it("allows genuine public endpoints", () => {
    expect(isValidPublicUrl("https://api.anthropic.com/v1")).toBe(true);
    expect(
      isValidPublicUrl("https://generativelanguage.googleapis.com/v1beta"),
    ).toBe(true);
    expect(isValidPublicUrl("https://api.openai.com/v1")).toBe(true);
    expect(isValidPublicUrl("http://172.32.0.1/v1")).toBe(true); // outside 172.16-172.31 block
  });

  it("classifies hosts without needing a full URL", () => {
    expect(isPrivateHost("127.0.0.1")).toBe(true);
    expect(isPrivateHost("172.15.0.1")).toBe(false);
    expect(isPrivateHost("example.com")).toBe(false);
  });

  describe("assertPublicBaseUrl", () => {
    it("throws a provider-shaped 400 for a blocked URL", () => {
      try {
        assertPublicBaseUrl("http://169.254.169.254/", "Anthropic");
        expect.unreachable("should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderRequestError);
        expect((error as ProviderRequestError).status).toBe(400);
      }
    });

    it("accepts an absent base URL", () => {
      expect(() => assertPublicBaseUrl(null, "Anthropic")).not.toThrow();
      expect(() => assertPublicBaseUrl(undefined, "Google")).not.toThrow();
      expect(() => assertPublicBaseUrl("", "OpenAI")).not.toThrow();
    });

    it("accepts a public base URL", () => {
      expect(() =>
        assertPublicBaseUrl("https://api.anthropic.com/v1", "Anthropic"),
      ).not.toThrow();
    });
  });
});
