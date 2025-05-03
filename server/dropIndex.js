const mongoose = require('mongoose');
require('dotenv').config();

async function dropIndex() {
    try {
        // Connect to MongoDB
        const mongoURI = process.env.MONGO_URI.replace(
            /:([^/]+)@/,
            (match, p1) => `:${encodeURIComponent(p1)}@`
        );

        await mongoose.connect(mongoURI);
        console.log('Connected to MongoDB');

        // Get the collection
        const collection = mongoose.connection.db.collection('userinputs');

        // Drop the index
        await collection.dropIndex('groupCode_1');
        console.log('Successfully dropped the unique index on groupCode');

        // Close the connection
        await mongoose.connection.close();
        console.log('MongoDB connection closed');
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

dropIndex(); 