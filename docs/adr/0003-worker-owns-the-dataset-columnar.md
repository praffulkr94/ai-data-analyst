# The worker owns the dataset, stored columnar

Parsed data lives only inside the Web Worker, in a columnar layout (typed arrays for numbers and
epoch-millisecond dates, dictionary encoding for string columns under 50% cardinality). The main
thread holds a handle carrying row count, column metadata and a small sample — never the rows.

**Considered options:** parsing on the main thread, or transferring rows to the worker per job.
Both were rejected because structured-cloning 100k row objects costs more main-thread time than
the computation it would escape. Measured against the real dataset, every string column encodes
(teams 328/49,520, cities 2,092/49,520, scorers 15,350/47,914).
