"""Read-only release-UI checks. Fresh Android XML bounds, no production credentials or API mutations."""
import json
import pathlib
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

serial, destination = sys.argv[1:3]
output = pathlib.Path(destination)
output.mkdir(parents=True, exist_ok=True)


def adb(*args):
    return subprocess.check_output(['adb', '-s', serial, *args], timeout=25)


def tree():
    focus = adb('shell', 'dumpsys', 'window').decode()
    if not re.search(r'mCurrentFocus=.*ru\.berisegodnya\.app', focus):
        # The disposable emulator has no accounts or entered credentials. Preserve the cause, not a false PASS.
        (output/'failure-window.txt').write_text(focus)
        (output/'failure-focus.png').write_bytes(adb('exec-out', 'screencap', '-p'))
        (output/'failure-crash.txt').write_bytes(adb('logcat', '-b', 'crash', '-d'))
        raise AssertionError('Not the native application: ' + str(re.findall(r'mCurrentFocus=.*', focus)))
    raw = adb('exec-out', 'uiautomator', 'dump', '/dev/tty').decode()
    source = raw[raw.index('<?xml'):raw.index('</hierarchy>') + len('</hierarchy>')]
    return source, ET.fromstring(source)


def node(label, clickable=False):
    _, current = tree()
    for entry in current.iter('node'):
        if label not in (entry.get('text'), entry.get('content-desc')):
            continue
        if clickable and entry.get('clickable') != 'true':
            continue
        bounds = list(map(int, re.findall(r'\d+', entry.get('bounds', ''))))
        if len(bounds) == 4 and bounds[2] > bounds[0] and bounds[3] > bounds[1]:
            return entry, bounds
    return None, None


def scroll(direction):
    _, current = tree()
    target = next((e for e in current.iter('node') if e.get('scrollable') == 'true' and e.get('class') == 'android.widget.ScrollView'), None)
    if target is None:
        return False
    x1, y1, x2, y2 = map(int, re.findall(r'\d+', target.get('bounds')))
    low, high = y1+(y2-y1)*3//4, y1+(y2-y1)//4
    start, end = (low, high) if direction == 'up' else (high, low)
    adb('shell', 'input', 'swipe', str((x1+x2)//2), str(start), str(end), '300')
    time.sleep(.4)
    return True


def tap(label, scrolling=False):
    for _ in range(7 if scrolling else 1):
        entry, bounds = node(label, True)
        if entry is not None:
            x1, y1, x2, y2 = bounds
            adb('shell', 'input', 'tap', str((x1+x2)//2), str((y1+y2)//2))
            time.sleep(.6)
            return
        if scrolling:
            _, current = tree()
            scroll = next((e for e in current.iter('node') if e.get('scrollable') == 'true'), None)
            assert scroll is not None, 'No scrollable form'
            x1, y1, x2, y2 = map(int, re.findall(r'\d+', scroll.get('bounds')))
            x = (x1+x2)//2
            adb('shell', 'input', 'swipe', str(x), str(y1+(y2-y1)*3//4), str(x), str(y1+(y2-y1)//4), '300')
    raise AssertionError('Visible clickable node missing: '+label)


def capture(name, expected):
    source, current = tree()
    texts = [e.get('text', '') for e in current.iter('node')]
    assert expected in texts, 'Expected native heading missing: '+expected
    assert not any('WebView' in e.get('class', '') for e in current.iter('node')), 'WebView in native core UI'
    (output/(name+'.xml')).write_text(source)
    (output/(name+'.png')).write_bytes(adb('exec-out', 'screencap', '-p'))
    return current


adb('shell', 'am', 'start', '-W', '-n', 'ru.berisegodnya.app/.MainActivity')
for _ in range(30):
    if re.search(r'mCurrentFocus=.*ru\.berisegodnya\.app', adb('shell', 'dumpsys', 'window').decode()):
        break
    time.sleep(1)
time.sleep(4)
offers_loaded = False
for _ in range(12):
    if node('Обновить', True)[0] is not None:
        offers_loaded = True
        break
    # A populated catalogue puts Refresh below the first screen. It is not a network failure.
    scroll('up')
    time.sleep(1)
if offers_loaded:
    for _ in range(12):
        if node('Что забрать сегодня')[0] is not None:
            break
        assert scroll('down'), 'Cannot return to catalogue heading'
capture('01-offers', 'Что забрать сегодня')
if not offers_loaded:
    (output/'failure-network-types.txt').write_bytes(adb('logcat', '-d', '-s', 'BeriToday:W'))
    (output/'failure-connectivity.txt').write_bytes(adb('shell', 'dumpsys', 'connectivity'))
assert offers_loaded, 'Public offers Refresh control was not reachable; inspect UI/network before claiming live connectivity'
tap('Мои брони')
capture('02-bookings', 'Мои брони')
tap('Профиль')
capture('02c-customer-entry', 'Мой кабинет')
assert node('Выбрать товар без регистрации', True)[0] is not None, 'Optional customer account has no visible guest exit'
tap('Выбрать товар без регистрации')
capture('02d-customer-guest-exit', 'Что забрать сегодня')
tap('Мои брони')
# A rejected link must reuse the activity, not spawn a second in-memory booking/draft store.
adb('shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', 'https://berisegodnya.ru/booking/invalid', '-n', 'ru.berisegodnya.app/.MainActivity')
time.sleep(.6)
capture('02b-single-activity', 'Мои брони')
tap('Партнёрам')
capture('03-partner-entry', 'Партнёрам')
tap('Войти в кабинет')
capture('04-partner-login', 'Вход для партнёра')
tap('Показать пароль', True)
assert node('Скрыть пароль')[0] is not None, 'Password visibility did not switch'
tap('Скрыть пароль')
adb('shell', 'input', 'keyevent', '4')
time.sleep(.6)
capture('05-partner-back', 'Партнёрам')
tap('Вход администратора проекта', True)
capture('06-admin-login', 'Вход администратора')
adb('shell', 'input', 'keyevent', '4')
time.sleep(.6)
tap('Оставить заявку')
capture('07-application', 'Подключить заведение')
tap('Телефон: десять цифр после +7', True)
adb('shell', 'input', 'text', '79001234567')
time.sleep(.6)
phone, _ = node('Телефон: десять цифр после +7')
assert phone is not None and phone.get('text') == '9001234567', 'Fixed +7 phone normalization failed'
source, current = tree()
assert any(e.get('text') == '+7' for e in current.iter('node')), 'Country prefix missing'
assert not any(e.get('text') == 'Предложения' for e in current.iter('node')), 'Bottom navigation takes up space above the keyboard'
(output/'08-phone-keyboard.xml').write_text(source)
(output/'08-phone-keyboard.png').write_bytes(adb('exec-out', 'screencap', '-p'))
adb('shell', 'input', 'keyevent', '4')
adb('shell', 'input', 'keyevent', '4')
time.sleep(.6)
capture('09-application-back', 'Партнёрам')
assert node('Предложения', True)[0] is not None, 'Bottom navigation not restored after closing keyboard'
# A syntactically valid read-only link must return to buyer history, not the previous role/login screen.
tap('Войти в кабинет')
adb('shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', 'https://berisegodnya.ru/booking/booking-view-cloud-read-only', '-n', 'ru.berisegodnya.app/.MainActivity')
time.sleep(1)
capture('10-booking-link', 'Ваша бронь')
adb('shell', 'input', 'keyevent', '4')
time.sleep(.6)
capture('11-booking-link-back', 'Мои брони')
adb('shell', 'am', 'force-stop', 'ru.berisegodnya.app')
adb('shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', 'https://berisegodnya.ru/booking/booking-view-cloud-read-only', '-n', 'ru.berisegodnya.app/.MainActivity')
time.sleep(3)
capture('12-cold-booking-link', 'Ваша бронь')
adb('shell', 'input', 'keyevent', '4')
time.sleep(.6)
capture('13-cold-booking-link-back', 'Мои брони')
activities = adb('shell', 'dumpsys', 'activity', 'activities').decode()
(output/'activity-stack.txt').write_text(activities)
activity_count = len(re.findall(r'Hist\s+#\d+:\s+ActivityRecord\{[^\n]*ru\.berisegodnya\.app/(?:\.|ru\.berisegodnya\.app\.)MainActivity', activities))
assert activity_count == 1, f'Expected exactly one native workspace after booking links; found {activity_count}'
crashes = adb('logcat', '-b', 'crash', '-d').decode()
assert 'ru.berisegodnya.app' not in crashes, 'Application crash recorded'
(output/'summary.json').write_text(json.dumps({'scope':'read-only cloud Android 13 native release UI', 'realTecnoAccepted':False, 'productionCredentialUsed':False, 'apiMutations':False, 'checks':['native focus/no WebView','public offers API loaded successfully','visitor tabs','optional customer profile with visible guest exit','single activity rejects malformed booking link without restarting workspace','visible partner/admin entrances','native forms','inline password eye','Android back','fixed +7 phone','keyboard hides bottom navigation and restores it','warm and cold booking links return only to buyer history','one MainActivity after repeated links','no recorded app crash']}, ensure_ascii=False, indent=2))
print('Native cloud UI QA: PASS (physical partner/booking/handover checks still required)')
