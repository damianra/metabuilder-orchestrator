// Hijo fake para tests de la cola: falla si los args contienen "malo".
process.exit(process.argv.includes('malo') ? 3 : 0);
