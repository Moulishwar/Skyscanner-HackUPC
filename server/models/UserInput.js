const mongoose = require('mongoose');

const userInputSchema = new mongoose.Schema({
    airport: {
        type: String,
        required: [true, 'Airport is required']
    },
    departureDate: {
        type: Date,
        required: [true, 'Departure date is required'],
        validate: {
            validator: function(v) {
                return v instanceof Date && !isNaN(v);
            },
            message: 'Invalid departure date'
        }
    },
    returnDate: {
        type: Date,
        required: [true, 'Return date is required'],
        validate: {
            validator: function(v) {
                return v instanceof Date && !isNaN(v);
            },
            message: 'Invalid return date'
        }
    },
    tags: {
        type: String,
        trim: true,
        default: ''
    },
    groupCode: {
        type: String,
        required: [true, 'Group code is required'],
        trim: true,
        index: true,
        unique: false
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Add validation to ensure return date is after departure date
userInputSchema.pre('save', function(next) {
    if (this.returnDate < this.departureDate) {
        next(new Error('Return date must be after departure date'));
    }
    next();
});

module.exports = mongoose.model('UserInput', userInputSchema);
