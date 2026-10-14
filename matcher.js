// const { Pool } = require('pg');

// const pool = new Pool({
//     user: 'postgres',
//     host: 'localhost',
//     database: 'postgres',
//     password: '9646',
//     port: 5432,
// });

const pool = require('./db');


async function runMatchmaker() {
    try {
        const client = await pool.connect();
        console.log('Successfully Connected');

        try {
            await client.query('BEGIN');

            const result = await client.query(`SELECT * FROM queue WHERE status = 'waiting' ORDER BY joined_at LIMIT 20 FOR UPDATE SKIP LOCKED`);
            // console.log(result.rows)

            function findPairs(rows) {
                const pairs = [];
                const used = new Set();

                for (let i = 0; i < rows.length; i++) {
                    if (used.has(i)) continue;

                    for (let j = i + 1; j < rows.length; j++) {
                        if (used.has(j)) continue;

                        let diff = Math.abs(rows[i].rating - rows[j].rating);

                        if (diff <= 100) {
                            pairs.push([rows[i], rows[j]]);
                            used.add(i);
                            used.add(j);
                            break;
                        }
                    }
                }
                return pairs;
            }

            const pairs = findPairs(result.rows);
            // console.log(pairs);
            // await client.query(``)

            for (const [q1, q2] of pairs) {
                await client.query("UPDATE queue SET status = 'matched' WHERE id = $1", [q1.id]);
                await client.query("UPDATE queue SET status = 'matched' WHERE id = $1", [q2.id]);

                await client.query("UPDATE players SET status = 'in_match' WHERE id = $1", [q1.player_id]);
                await client.query("UPDATE players SET status = 'in_match' WHERE id = $1", [q2.player_id]);

                await client.query("INSERT INTO matches (player1_id, player2_id) VALUES ($1, $2)", [q1.player_id, q2.player_id]);
            }

            await client.query('COMMIT');
        }

        catch (dbErr) {
            await client.query('ROLLBACK')
            console.error('Error', dbErr.message);
        }
        finally {
            client.release();
        }
    }
    catch (err) {
        console.error('connection failed', err.message);
    }
    // try {
    //     const client = await pool.connect();
    //     console.log('Successfully Connected');
    //     //update matches table and ratings too
    //     try{
    //         await client.query('BEGIN');

    //         const resultRows = await client.query("SELECT * FROM matches WHERE status = 'ongoing'");

    //         for(let i = 0; i < resultRows.length; i++){
    //             const p1_id = resultRows[i].player1_id;
    //             const p2_id = resultRows[i].player2_id;

    //         }
    //     }
    // }
    try {
        const client = await pool.connect();
        console.log('Successfully Connected');
        //EXPIRY transaction
        try {

            await client.query('BEGIN');

            const waitingRows = await client.query("SELECT id, player_id FROM queue WHERE status = 'waiting' AND joined_at + INTERVAL '30 second' <= NOW() FOR UPDATE SKIP LOCKED ");


            const rows = waitingRows.rows;

            if (rows.length > 0) {
                const queueId = rows.map(r => r.id);
                const playerId = rows.map(r => r.player_id);

                await client.query("UPDATE queue SET status = 'expired' WHERE id = ANY($1)", [queueId]);
                await client.query("UPDATE players SET status = 'idle' WHERE id = ANY($1)", [playerId]);

            }
            await client.query('COMMIT');
        }

        catch (dbErr) {
            await client.query('ROLLBACK');
            console.error("Error", dbErr.message);
        }
        finally {
            client.release();
        }
    }
    catch (err) {
        console.error('connection failed', err.message);
    }
}


//endmatch function
async function endMatch(matchId){
    try{
        const client = await pool.connect();
        console.log('End match pool successfully connected');

        try{
            await client.query('BEGIN');

            const matchResult = await client.query("SELECT player1_id, player2_id, status FROM matches WHERE id = $1 FOR UPDATE", [matchId]);

            const match = matchResult.rows[0];

            if(!match || match.status !== 'ongoing'){
                console.log('No match');
                await client.query('ROLLBACK');
                return;
            }
            const player1Id = match.player1_id;
            const player2Id = match.player2_id;
            let player1Rating = (await client.query("SELECT rating FROM players WHERE id = $1 FOR UPDATE", [player1Id])).rows[0].rating;
            let player2Rating = (await client.query("SELECT rating FROM players WHERE id = $1 FOR UPDATE", [player2Id])).rows[0].rating;
            

            const winnerId = Math.random() < 0.5 ? player1Id : player2Id;
            // const loserId = winnerId === player1Id ? player2Id : player1Id;

            if(winnerId === player1Id){
                player1Rating += 25;
                player2Rating = Math.max(0, player2Rating - 25);
            }
            else{
                player2Rating += 25;
                player1Rating = Math.max(0, player1Rating - 25);
            }

            // update rating in players table
            await client.query("UPDATE players SET rating = $1, status = 'idle' WHERE id = $2", [player1Rating, player1Id]);
            await client.query("UPDATE players SET rating = $1, status = 'idle' WHERE id = $2", [player2Rating, player2Id]);

            //update matches table
            await client.query("UPDATE matches SET status = 'completed', winner_id = $1 WHERE id = $2", [winnerId, matchId]);
            await client.query("COMMIT"); 
        }
        catch (dbErr) {
            await client.query('ROLLBACK');
            console.error("Error", dbErr.message);
        }
        finally {
            client.release();
        }
    }
    catch (err) {
        console.error('connection failed', err.message);
    }
}
//Automation engine
const POLL_INTERVAL = 3000;

async function startWorker() {
    console.log("Matching started");
    
    while (true) {
        await runMatchmaker();
        // endMatch(19);
        
        //wait 3 seconds before executing  the next scan
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
    }
}
// startWorker();
// endMatch(14);
// endMatch(15);
// endMatch(16);

module.exports = { runMatchmaker, endMatch, startWorker };
