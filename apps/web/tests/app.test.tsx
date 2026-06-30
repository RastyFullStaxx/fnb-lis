import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import App from "../src/App";
import { AppProvider } from "../src/context/AppContext";

function renderRoute(route: string) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AppProvider>
        <App />
      </AppProvider>
    </MemoryRouter>
  );
}

describe("prototype routes", () => {
  it("renders the operational overview", () => {
    renderRoute("/overview");
    expect(screen.getByRole("heading", { name: /good morning/i })).toBeInTheDocument();
    expect(screen.getByText("Priority queue")).toBeInTheDocument();
  });

  it("renders the interactive audit count sheet", () => {
    renderRoute("/audits/AUD-2026-0628/count");
    expect(screen.getByRole("heading", { name: "June 28 Weekly Audit" })).toBeInTheDocument();
    expect(screen.getByLabelText("London Dry Gin full count")).toBeInTheDocument();
  });

  it("renders the import review guardrail", () => {
    renderRoute("/imports/IMP-308/review");
    expect(screen.getByRole("heading", { name: "Review extracted rows" })).toBeInTheDocument();
    expect(screen.getByText("Changes here do not affect stock.")).toBeInTheDocument();
  });
});
