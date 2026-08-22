# Hand-rolled typed worker RPC instead of Comlink

Worker communication is a hand-written discriminated-union message protocol with correlation ids
and cooperative cancellation, roughly 80 lines. Comlink was rejected because its proxy model hides
the exact mechanism this project exists to demonstrate, and because it makes progress streaming and
mid-job cancellation awkward. This is a deliberate choice, not an oversight — see ADR-0013.
