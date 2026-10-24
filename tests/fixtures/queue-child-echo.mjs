// Hijo fake con output: escribe por stdout/stderr para el test del log.
console.log('MARK-STDOUT');
console.error('MARK-STDERR');
process.exit(0);
