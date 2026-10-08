/**
 * Список подсистем оболочки и окно подсистемы.
 *
 * Меню строится из схемы оболочки, которую сервер отдаёт вместе с описаниями объектов, а не из
 * ресурсов Refine: один объект может стоять в нескольких группах и подсистемах, а ресурс у объекта
 * один. По той же причине подсистема не подсвечивается по открытой странице: страница объекта
 * не принадлежит одной подсистеме.
 */
import { AppstoreOutlined, BarChartOutlined, BookOutlined, FileTextOutlined, ProfileOutlined } from '@ant-design/icons';
import { Flex, Menu, Modal, theme, Typography } from 'antd';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { MetadataResponse, ShellItem, ShellSubsystem } from '../../server/ui/descriptions';
import { objectPath, pagePath } from '../common/paths';
import { findObjectView, useMetadata } from '../data-provider/metadata';

/**
 * Иконки пунктов по видам объектов и иконка страницы конфигурации. Вид пункта известен из схемы
 * оболочки, поэтому иконок она не задаёт.
 */
const kindIcons: { readonly [Kind in ShellItem['kind']]: ReactNode } = {
    catalog: <BookOutlined />,
    document: <FileTextOutlined />,
    register: <BarChartOutlined />,
    informationRegister: <ProfileOutlined />,
    page: <AppstoreOutlined />,
};

/**
 * Заголовок и адрес пункта группы. Возвращает `undefined`, если объекта или страницы нет среди
 * доступных пользователю: сервер такие пункты из схемы убирает, и здесь это только защита.
 */
function shellLink(metadata: MetadataResponse | undefined, item: ShellItem): { readonly title: string; readonly path: string } | undefined {
    if (item.kind === 'page') {
        const page = metadata?.pages.find((candidate) => candidate.name === item.name);
        return page === undefined ? undefined : { title: page.title, path: pagePath(page.name) };
    }
    const object = findObjectView(metadata, item);
    return object === undefined ? undefined : { title: object.title, path: objectPath(object) };
}

/** Подсистемы, доступные пользователю. Нажатие на подсистему открывает окно с её группами и объектами. */
export function SubsystemList() {
    const subsystems = useMetadata().data?.shell.subsystems ?? [];
    const [openedName, setOpenedName] = useState<string | null>(null);
    const opened = subsystems.find((subsystem) => subsystem.name === openedName);
    return (
        <>
            <Menu
                mode="inline"
                selectable={false}
                style={{ borderInlineEnd: 'none' }}
                items={subsystems.map((subsystem) => ({ key: subsystem.name, label: subsystem.title }))}
                onClick={({ key }) => setOpenedName(key)}
            />
            {opened === undefined ? null : <SubsystemDialog subsystem={opened} onClose={() => setOpenedName(null)} />}
        </>
    );
}

/** Окно подсистемы: группы с заголовками и ссылки на списки объектов и страницы конфигурации. Переход по ссылке закрывает окно. */
function SubsystemDialog({ subsystem, onClose }: { readonly subsystem: ShellSubsystem; readonly onClose: () => void }) {
    const { token } = theme.useToken();
    const metadata = useMetadata().data;
    return (
        <Modal open title={subsystem.title} footer={null} width={720} onCancel={onClose}>
            <Flex wrap gap={token.marginLG} align="start">
                {subsystem.groups.map((group, index) => (
                    // Заголовки групп могут совпадать, а порядок групп в схеме постоянен, поэтому ключом служит номер.
                    <Flex key={index} vertical gap={token.marginXS} style={{ minWidth: 200 }}>
                        <Typography.Text type="secondary">{group.title}</Typography.Text>
                        {group.items.map((item) => {
                            const link = shellLink(metadata, item);
                            if (link === undefined) return null;
                            return (
                                <Link key={`${item.kind}.${item.name}`} to={link.path} onClick={onClose}>
                                    <Flex gap={token.marginXS} align="center">
                                        {kindIcons[item.kind]}
                                        {link.title}
                                    </Flex>
                                </Link>
                            );
                        })}
                    </Flex>
                ))}
            </Flex>
        </Modal>
    );
}
