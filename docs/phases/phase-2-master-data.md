# Phase 2 — Master Data & Location Catalog

**Goal:** Full catalog management: everything an ADMIN/MANAGER needs to define what can be counted, bought, and sold — including the universal bits (custom types, units, weighing profiles).

## Tasks

- `/api/master`: units (custom units with kind + factor), categories (productType + defaultDensityFactor), items, variants; product-types endpoint backed by Setting
- Items page — Tabs (Items / Categories / Units): items table with variant sub-rows; item Sheet form with variant editor (size+unit, contentTracked, tare weight, density factor with "inherited from category" hint); duplicate-name check (legacy behavior)
- Stock page (location catalog): attach-variant dialog (Command search of master), cost/retail inline edit (ActivityLog with old/new), **red badge on missing prices** (legacy behavior), copy-from-location dialog (legacy "copy local database"), active/inactive
- Suppliers CRUD (per client)
- Seed v2: sample items/variants/prices — Absolut 700ml+1L (tare 478/460 g, density from category), Jack Daniel's 700, Bacardi 750, Bombay 750, Jose Cuervo 750, San Miguel 330 (contentTracked=false), Tonic 200, Grenadine 750, Chicken Breast 1kg, Cooking Oil 1L, **Table Napkins pack (Supplies, COUNT)** — universality proof; one item deliberately missing retail
- Git commit

## Done when

- Through the UI alone: create "Test Rum 700 ml" with tare + density → attach to Main Bar with cost/retail → appears in Stock with correct badge state
- Price edit writes ActivityLog old/new
- A Supplies-type COUNT item behaves identically to beverages (no weighing fields shown)
