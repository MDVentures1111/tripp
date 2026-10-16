export async function runGate(steps: Array<() => Promise<boolean>>): Promise<number> {
  for (let i = 0; i < steps.length; i++) {
    if (!(await steps[i]())) return i;
  }
  return -1;
}
