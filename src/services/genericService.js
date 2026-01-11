// Generic service wrapper around model modules
function createService(model) {
  return {
    create: async (data) => model.create(data),
    getById: async (id) => model.findById(id),
    list: async (opts) => model.list(opts),
    update: async (id, data) => model.edit(id, data),
    remove: async (id) => model.remove(id),
  };
}

module.exports = { createService };
