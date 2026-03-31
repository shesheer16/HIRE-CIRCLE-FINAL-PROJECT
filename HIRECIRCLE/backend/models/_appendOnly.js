const immutableError = (next) => next(new Error('Append-only collection: updates and deletes are not allowed'));

const applyAppendOnlyGuards = (schema) => {
    schema.pre('updateOne', immutableError);
    schema.pre('updateMany', immutableError);
    schema.pre('findOneAndUpdate', immutableError);
    schema.pre('replaceOne', immutableError);
    schema.pre('deleteOne', immutableError);
    schema.pre('deleteMany', immutableError);
    schema.pre('findOneAndDelete', immutableError);
    schema.pre('findByIdAndDelete', immutableError);
};

module.exports = {
    applyAppendOnlyGuards,
};
