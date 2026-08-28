import uvicorn
import os

from api import create_app

# use HOST=127.0.0.1 when running local tests
#     HOST=0.0.0.0   when running in docker
HOST_IP = os.environ["HOST"]


app = create_app()


if __name__ == "__main__":
    uvicorn.run(app, host=HOST_IP, port=8000)
