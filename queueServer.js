const express = require("express");
const path = require("path");

function startQueueServer(db){

const app = express();

app.use(express.static(path.join(__dirname,"web")));

app.get("/api/queue",(req,res)=>{

const queue = db.listFortniteQueue();

const users = queue.map(entry => {

if(entry.entry_type === "guest"){
return `${entry.guest_name} - ${entry.epic_username}`;
}

return entry.user_id;

});

res.json(users);

});

const PORT = 3000;

app.listen(PORT,()=>{
console.log("Queue overlay running on http://localhost:"+PORT+"/queue.html");
});

}

module.exports = { startQueueServer };