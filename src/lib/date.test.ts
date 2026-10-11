import { describe, expect, it } from "vitest";

import {
  currentPeriod,
  defaultDueDate,
  formatDate,
  todayISO,
  toPeriod,
} from "@/lib/date";

describe("formatDate", () => {
  it("formata string YYYY-MM-DD como dd/mm/aaaa", () => {
    expect(formatDate("2024-03-07")).toBe("07/03/2024");
    expect(formatDate("2024-12-25")).toBe("25/12/2024");
  });

  it("preserva o dia pretendido (sem off-by-one de fuso)", () => {
    // Em UTC puro, 2024-01-01 à meia-noite poderia recuar para 31/12 em SP.
    expect(formatDate("2024-01-01")).toBe("01/01/2024");
  });

  it("resolve instantes no fuso America/Sao_Paulo", () => {
    // 2024-03-11T02:00:00Z = 2024-03-10 23:00 em SP (UTC-3).
    const date = new Date("2024-03-11T02:00:00.000Z");
    expect(formatDate(date)).toBe("10/03/2024");
  });

  it("mantém o mesmo dia quando o instante é durante o dia em SP", () => {
    // 2024-03-11T15:00:00Z = 2024-03-11 12:00 em SP.
    const date = new Date("2024-03-11T15:00:00.000Z");
    expect(formatDate(date)).toBe("11/03/2024");
  });
});

describe("toPeriod", () => {
  it("retorna o período YYYY-MM de uma data", () => {
    expect(toPeriod("2024-03-07")).toBe("2024-03");
    expect(toPeriod("2024-12-31")).toBe("2024-12");
  });

  it("usa o fuso de SP para decidir o mês na virada", () => {
    // 2024-04-01T02:00:00Z = 2024-03-31 23:00 em SP → período 2024-03.
    const date = new Date("2024-04-01T02:00:00.000Z");
    expect(toPeriod(date)).toBe("2024-03");
  });
});

describe("currentPeriod", () => {
  it("deriva o período atual no fuso de SP", () => {
    const now = new Date("2024-06-15T12:00:00.000Z");
    expect(currentPeriod(now)).toBe("2024-06");
  });
});

describe("todayISO", () => {
  it("retorna a data civil YYYY-MM-DD no fuso de SP", () => {
    // 2024-01-01T01:00:00Z = 2023-12-31 22:00 em SP.
    const now = new Date("2024-01-01T01:00:00.000Z");
    expect(todayISO(now)).toBe("2023-12-31");
  });

  it("mantém o dia durante o horário comercial em SP", () => {
    const now = new Date("2024-07-20T18:00:00.000Z");
    expect(todayISO(now)).toBe("2024-07-20");
  });
});

describe("defaultDueDate", () => {
  it("usa o dia de vencimento no mês corrente quando ainda não passou", () => {
    // 05/06/2024, dueDay 10 → vence 10/06/2024.
    const now = new Date("2024-06-05T12:00:00.000Z");
    expect(defaultDueDate(10, now)).toBe("2024-06-10");
  });

  it("usa o próprio dia quando hoje é o dia do vencimento", () => {
    const now = new Date("2024-06-10T12:00:00.000Z");
    expect(defaultDueDate(10, now)).toBe("2024-06-10");
  });

  it("avança para o mês seguinte quando o dia já passou", () => {
    // 20/06/2024, dueDay 10 → vence 10/07/2024.
    const now = new Date("2024-06-20T12:00:00.000Z");
    expect(defaultDueDate(10, now)).toBe("2024-07-10");
  });

  it("vira o ano ao avançar de dezembro para janeiro", () => {
    const now = new Date("2024-12-20T12:00:00.000Z");
    expect(defaultDueDate(10, now)).toBe("2025-01-10");
  });

  it("rejeita dia de vencimento fora de 1..28", () => {
    expect(() => defaultDueDate(0)).toThrow();
    expect(() => defaultDueDate(29)).toThrow();
    expect(() => defaultDueDate(10.5)).toThrow();
  });
});
