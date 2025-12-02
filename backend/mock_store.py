class MockSecretStore:
    def get_secret(self, key):
        return "38dd87bbfef35a1f4dc6133293bed27f0e2c9ff7"

class MockCacheStore:
    def store(self, key, value):
        pass
    def load(self, key, max_age_minutes=None):
        return None
