const express = require('express');
const router = express.Router();
const UserInput = require('../models/UserInput');

// Get all members of a group
router.get('/:groupCode/members', async (req, res) => {
  try {
    const { groupCode } = req.params;
    
    // Find all users with the given group code, sorted by creation date
    const members = await UserInput.find({ groupCode })
      .sort({ createdAt: 1 }) // Sort by creation date, oldest first
      .select('-__v'); // Exclude version field
    
    res.json(members);
  } catch (error) {
    console.error('Error fetching group members:', error);
    res.status(500).json({ error: 'Failed to fetch group members' });
  }
});

module.exports = router; 