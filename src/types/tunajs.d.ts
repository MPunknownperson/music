declare module "tunajs" {
  const Tuna: new (ctx: AudioContext) => Record<string, new (opts: Record<string, number>) => AudioNode>;
  export default Tuna;
}
