describe('test', () => {
  it('should throw', async () => {
    try {
      throw new Error('url should not be empty')
    } catch (err) {
      should.throw(
        () => {
          throw err
        },
        Error,
        'url should not be empty',
      )
    }
  })
})
