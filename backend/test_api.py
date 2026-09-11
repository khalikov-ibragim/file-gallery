import requests #Подключаю библиотеку request

BASE = "http://localhost:4000" #Создал переменную с адрессом который буду часто использовать

def main(): #Создание функции с именем main
    # 1. Список товаров должен отвечать 200
    r = requests.get(f"{BASE}/health") #Отправляет GET-запрос по адрессу и делает возврат обьекта r
    assert r.status_code == 200, f"health: ожидал 200, получил {r.status_code}" #если условие правда то ничего не происходит.Если лож то программа падает  с этим сообщением
    print(f"[OK] health -> {r.status_code}")

    # 1. Список товаров должен отвечать 200
    r = requests.get(f"{BASE}/api/files") #Отправляет GET-запрос по адрессу и делает возврат обьекта r
    assert r.status_code == 200, f"files: ожидал 200, получил {r.status_code}" #если условие правда то ничего не происходит.Если лож то программа падает  с этим сообщением
    print(f"[OK] files -> {r.status_code}")


    # 3. Загрузка файла
    r = requests.post(f"{BASE}/api/upload", files={"file": ("hello.txt", b"hello world", "text/plain")})
    assert r.status_code == 200, f"upload: ожидал 200 но получил {r.status_code}"
    file_id = r.json()["id"]
    print(f"[OK] upload -> {r.status_code}")

    r = requests.delete(f"{BASE}/api/files/{file_id}")
    assert r.status_code == 200, f"delete: ожидал 200 но получил {r.status_code}"
    print(f"[OK] delete -> {r.status_code}")

if __name__ == "__main__":
    main()