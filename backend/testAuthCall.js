require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/userModel');
const jwt = require('jsonwebtoken');
const axios = require('axios');

async function test() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        const user = await User.findOne({});
        if (!user) throw new Error("No user found");

        const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '30d' });
        // Now try the GET request with this token
        const res = await axios.get('http://localhost:5001/api/chat/undefined', {
            headers: { Authorization: `Bearer ${token}` }
        });

        console.log("SUCCESS:", res.status);
        console.log("DATA:", res.data);
        process.exit(0);
    } catch (err) {
        console.warn("Request Failed!");
        if (err.response) {
            console.warn("STATUS:", err.response.status);
            console.warn("DATA:", err.response.data);
        } else {
            console.warn(err.message);
        }
        process.exit(1);
    }
}
test();
