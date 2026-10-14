const express = require('express');
const pool = require('./db');
const {startWorker, endMatch} = require('./matcher');

const app = express();
app.use(express.json());

app.listen(3000, () => console.log("Server listening on port 3000"));
startWorker();