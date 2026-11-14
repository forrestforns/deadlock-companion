haste: https://github.com/blukai/haste @ d2cdbf2 (MIT), vendored with one patch in crates/haste_vartype:
newer Deadlock builds use multi-argument templates such as
'CNetworkUtlVectorBase< T, NetworkVar_x , -1, int >'; the tokenizer now accepts ',' and negative
numbers, and the parser keeps the first template argument (the one that drives decoding).
