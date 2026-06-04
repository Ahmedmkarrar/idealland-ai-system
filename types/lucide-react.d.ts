// Silences TS7016 implicit-any warnings from lucide-react's CJS bundle.
// The library ships its own .d.ts, but our project resolves the CJS entry
// without picking them up — declaring the module here is the lightest fix.
declare module "lucide-react";
