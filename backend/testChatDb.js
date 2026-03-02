require('dotenv').config();
const mongoose = require('mongoose');
const Message = require('./models/Message');
const User = require('./models/userModel'); // need the schema registered!

async function test() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log("Connected to DB");
        const messages = await Message.find({ applicationId: '65f02bc0fe1234a56bcc7891' })
            .populate('sender', 'name firstName role');
        console.log("Messages found:", messages.length);
        process.exit(0);
    } catch (err) {
        console.warn("Test Error:", err);
        process.exit(1);
    }
}
test();
